export const BUCKET = 'materials';
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const STUDENT_EMAIL_DOMAIN = process.env.NEXT_PUBLIC_STUDENT_EMAIL_DOMAIN || 'students.local';
export const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || 'Asia/Seoul';

export const MATERIAL_TYPES = ['lecture', 'assignment', 'notice', 'other'] as const;

// Keep in sync with public.is_allowed_extension() in supabase/migrations/0003_storage.sql
export const ALLOWED_EXTENSIONS = [
  'pdf', 'ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx', 'hwp', 'hwpx', 'txt', 'md', 'csv',
  'zip', 'png', 'jpg', 'jpeg', 'gif', 'webp',
  'c', 'h', 'cpp', 'hpp', 'java', 'py', 'js', 'jsx', 'ts', 'tsx', 'json', 'html', 'css', 'sql',
  'ipynb', 'r', 'm', 'go', 'rs', 'kt', 'swift', 'sh', 'yaml', 'yml', 'xml',
] as const;

export const SIGNED_URL_TTL = 60; // seconds, single-file download
export const ZIP_SIGNED_URL_TTL = 300; // seconds, per batch inside a ZIP job
export const MAX_ZIP_FILES = 2000;
export const PASSWORD_MIN_LENGTH = 10;
