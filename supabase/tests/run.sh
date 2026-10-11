#!/usr/bin/env bash
set -euo pipefail
# Isolated local PostgreSQL, no network/ports or credentials from production.
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
container="family-health-rls-${RANDOM}-$$"
cleanup(){ docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --detach --name "$container" --network none \
 -e POSTGRES_HOST_AUTH_METHOD=trust \
 --mount "type=bind,src=$repo_root,dst=/repo,readonly" postgres:16@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d >/dev/null
for attempt in {1..30};do
 if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1;then break;fi
 sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null
for file in /repo/supabase/tests/bootstrap.sql /repo/supabase/migrations/202610110001_family_access.sql /repo/supabase/tests/rls.sql /repo/supabase/tests/edges.sql /repo/supabase/tests/legacy.sql;do
 docker exec "$container" psql -X -U postgres -v ON_ERROR_STOP=1 -f "$file"
done
# Missing reviewed mapping must fail; no implicit assignment/import is permitted.
if docker exec "$container" psql -X -U postgres -v ON_ERROR_STOP=1 -f /repo/supabase/legacy/import-fictional-questions.sql >/dev/null 2>&1;then
 echo 'FAIL: import without reviewed mapping succeeded' >&2;exit 1
fi
echo 'PASS: optional import refuses missing reviewed mapping'
# Concurrent, independent connections must serialize sensitive membership changes.
python3 "$repo_root/supabase/tests/concurrency.py" "$container"
