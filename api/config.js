
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    familyAccessEnabled: process.env.FAMILY_ACCESS_ENABLED === "true",
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY || ""
  });
}
