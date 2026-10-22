const { createClient } = require('@supabase/supabase-js');
const bucket = process.env.SUPABASE_XEROX_BUCKET || 'xerox-private';
const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = configured ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) : null;

exports.storePrivatePdf = async (path, buffer) => {
  if (!client) return false;
  const { error } = await client.storage.from(bucket).upload(path, buffer, { contentType: 'application/pdf', upsert: false });
  if (error) throw new Error(`Private PDF storage failed: ${error.message}`);
  return true;
};

exports.readPrivatePdf = async path => {
  if (!client) return null;
  const { data, error } = await client.storage.from(bucket).download(path);
  if (error) throw new Error(`Private PDF download failed: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
};
exports.deletePrivatePdf = async path => {
  if (!client || !path) return;
  const { error } = await client.storage.from(bucket).remove([path]);
  if (error) throw new Error(`Private PDF deletion failed: ${error.message}`);
};

exports.usingSupabaseStorage = configured;

