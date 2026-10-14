// Seeds demo users, courses, enrollments and a few sample files.
// Usage: npm run seed   (reads .env.local; safe to run more than once)
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SEED_PASSWORD;
const domain = process.env.NEXT_PUBLIC_STUDENT_EMAIL_DOMAIN || 'students.local';

if (!url || !serviceKey) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
if (!password || password.length < 10) throw new Error('Set SEED_PASSWORD (at least 10 characters) in .env.local');

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function must({ data, error }, what) {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------- reference data
must(await db.from('departments').upsert(
  [
    { code: 'CSE', name: 'Computer Science & Engineering' },
    { code: 'BUS', name: 'Business Administration' },
  ],
  { onConflict: 'code', ignoreDuplicates: true },
), 'departments');

must(await db.from('semesters').upsert(
  [
    { name: '2026-1', start_date: '2026-03-02', end_date: '2026-06-19', is_current: false },
    { name: '2026-2', start_date: '2026-08-31', end_date: '2026-12-18', is_current: true },
  ],
  { onConflict: 'name', ignoreDuplicates: true },
), 'semesters');

const dept = Object.fromEntries(must(await db.from('departments').select('id, code'), 'departments').map((d) => [d.code, d.id]));
const sem = Object.fromEntries(must(await db.from('semesters').select('id, name'), 'semesters').map((s) => [s.name, s.id]));

// ------------------------------------------------------------------------- users
async function ensureUser({ loginId, email, name, role, department, year = null, semester = null, mustChange = false }) {
  const existing = must(await db.from('profiles').select('id').eq('login_id', loginId).maybeSingle(), 'profile lookup');
  if (existing) return existing.id;

  const created = must(await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role, must_change_password: mustChange },
    user_metadata: { full_name: name },
  }), `create ${loginId}`);

  must(await db.from('profiles').insert({
    id: created.user.id,
    role,
    login_id: loginId,
    full_name: name,
    email,
    department_id: department ? dept[department] : null,
    year,
    semester_id: semester ? sem[semester] : null,
    must_change_password: mustChange,
  }), `profile ${loginId}`);
  console.log(`  + ${role.padEnd(9)} ${loginId}`);
  return created.user.id;
}

console.log('Users');
await ensureUser({ loginId: 'admin', email: 'admin@campus.local', name: 'Portal Admin', role: 'admin' });
const profKim = await ensureUser({ loginId: 'P1001', email: 'kim.prof@campus.local', name: 'Kim Jiho', role: 'professor', department: 'CSE' });
const profLee = await ensureUser({ loginId: 'P1002', email: 'lee.prof@campus.local', name: 'Lee Seoyeon', role: 'professor', department: 'BUS' });

// ----------------------------------------------------------------------- courses
const courseRows = [
  // current semester
  { code: 'CSE101', name: 'Introduction to Programming', department: 'CSE', semester: '2026-2', year: 1, professor: profKim },
  { code: 'CSE201', name: 'Data Structures', department: 'CSE', semester: '2026-2', year: 2, professor: profKim },
  { code: 'CSE202', name: 'Computer Architecture', department: 'CSE', semester: '2026-2', year: 2, professor: profKim },
  { code: 'BUS101', name: 'Principles of Management', department: 'BUS', semester: '2026-2', year: 1, professor: profLee },
  { code: 'BUS201', name: 'Marketing Fundamentals', department: 'BUS', semester: '2026-2', year: 2, professor: profLee },
  // Professor Kim also teaches a course owned by another department.
  { code: 'BUS210', name: 'Business Data Analytics', department: 'BUS', semester: '2026-2', year: 2, professor: profKim },
  // past semester
  { code: 'CSE200', name: 'Discrete Mathematics', department: 'CSE', semester: '2026-1', year: 2, professor: profKim },
  { code: 'BUS200', name: 'Financial Accounting', department: 'BUS', semester: '2026-1', year: 2, professor: profLee },
];

must(await db.from('courses').upsert(
  courseRows.map((c) => ({
    code: c.code,
    name: c.name,
    department_id: dept[c.department],
    semester_id: sem[c.semester],
    year: c.year,
    professor_id: c.professor,
  })),
  { onConflict: 'semester_id,code', ignoreDuplicates: true },
), 'courses');

const courses = must(await db.from('courses').select('id, code, semester_id'), 'courses');
const courseId = (code, semester) => courses.find((c) => c.code === code && c.semester_id === sem[semester]).id;
console.log(`Courses: ${courses.length}`);

// ---------------------------------------------------------------------- students
const students = [
  { loginId: '20243237', name: 'Park Minjun', department: 'CSE', year: 2 },
  { loginId: '20243238', name: 'Choi Yuna', department: 'CSE', year: 2 },
  { loginId: '20253001', name: 'Jung Haeun', department: 'CSE', year: 1, mustChange: true },
  { loginId: '20242101', name: 'Han Doyun', department: 'BUS', year: 2 },
  { loginId: '20252102', name: 'Seo Jiwoo', department: 'BUS', year: 1 },
];

const studentIds = {};
for (const s of students) {
  const id = await ensureUser({
    ...s, email: `${s.loginId}@${domain}`, role: 'student', semester: '2026-2',
  });
  studentIds[s.loginId] = id;
  must(await db.rpc('auto_enroll_student', { p_student: id }), 'auto enroll');
}

// Exceptions: an elective from another department, plus last semester's courses.
const extra = [
  { student_id: studentIds['20243237'], course_id: courseId('BUS201', '2026-2'), source: 'manual' },
  { student_id: studentIds['20243237'], course_id: courseId('CSE200', '2026-1'), source: 'auto' },
  { student_id: studentIds['20243238'], course_id: courseId('CSE200', '2026-1'), source: 'auto' },
  { student_id: studentIds['20242101'], course_id: courseId('BUS200', '2026-1'), source: 'auto' },
];
must(await db.from('enrollments').upsert(extra, { onConflict: 'student_id,course_id', ignoreDuplicates: true }), 'enrollments');

// ------------------------------------------------------------- sample materials
async function sampleFile({ course, semester, key, fileName, title, type, week, body, uploader }) {
  const cid = courseId(course, semester);
  const path = `${cid}/${key}`;
  const bytes = Buffer.from(body, 'utf8');
  must(await db.storage.from('materials').upload(path, bytes, { contentType: 'text/plain', upsert: true }), `upload ${path}`);
  must(await db.from('materials').upsert(
    {
      course_id: cid, title, type, week, storage_path: path, file_name: fileName,
      size_bytes: bytes.byteLength, mime_type: 'text/plain', uploaded_by: uploader,
    },
    { onConflict: 'storage_path', ignoreDuplicates: true },
  ), `material ${title}`);
}

const samples = [
  { course: 'CSE201', semester: '2026-2', key: 'seed-syllabus.txt', fileName: 'syllabus.txt', title: 'Syllabus', type: 'other', week: null, uploader: profKim, body: 'Data Structures - syllabus\nWeeks 1-15: arrays, lists, trees, graphs, hashing.\n' },
  { course: 'CSE201', semester: '2026-2', key: 'seed-w1-notes.md', fileName: 'notes.md', title: 'Week 1 - Arrays and complexity', type: 'lecture', week: 1, uploader: profKim, body: '# Week 1\nBig-O notation and dynamic arrays.\n' },
  { course: 'CSE201', semester: '2026-2', key: 'seed-w2-notes.md', fileName: 'notes.md', title: 'Week 2 - Linked lists', type: 'lecture', week: 2, uploader: profKim, body: '# Week 2\nSingly and doubly linked lists.\n' },
  { course: 'CSE201', semester: '2026-2', key: 'seed-w2-list.py', fileName: 'linked_list.py', title: 'Linked list starter code', type: 'assignment', week: 2, uploader: profKim, body: 'class Node:\n    def __init__(self, value, next=None):\n        self.value = value\n        self.next = next\n' },
  { course: 'CSE202', semester: '2026-2', key: 'seed-w1-intro.txt', fileName: 'intro.txt', title: 'Week 1 - Introduction', type: 'lecture', week: 1, uploader: profKim, body: 'Computer Architecture: performance, ISA, datapath.\n' },
  { course: 'BUS201', semester: '2026-2', key: 'seed-w1-4p.txt', fileName: 'marketing-mix.txt', title: 'Week 1 - The marketing mix', type: 'lecture', week: 1, uploader: profLee, body: 'Product, Price, Place, Promotion.\n' },
  { course: 'CSE200', semester: '2026-1', key: 'seed-w1-logic.txt', fileName: 'logic.txt', title: 'Week 1 - Propositional logic', type: 'lecture', week: 1, uploader: profKim, body: 'Propositions, connectives and truth tables.\n' },
];
for (const s of samples) await sampleFile(s);
console.log(`Sample files: ${samples.length}`);

// ------------------------------------------------------- notices and assignments
const ds = courseId('CSE201', '2026-2');
const hasNotice = must(await db.from('notices').select('id').eq('course_id', ds).limit(1), 'notices');
if (hasNotice.length === 0) {
  must(await db.from('notices').insert([
    { course_id: ds, title: 'Welcome to Data Structures', body: 'Lecture slides are posted every Monday. Check the Week folders.', pinned: true, author_id: profKim },
    { course_id: ds, title: 'Midterm schedule', body: 'The midterm takes place in week 8 during regular class hours.', pinned: false, author_id: profKim },
    { course_id: courseId('BUS201', '2026-2'), title: 'Team project groups', body: 'Form groups of four by next Friday.', pinned: false, author_id: profLee },
  ]), 'notices');

  const due = (days) => new Date(Date.now() + days * 86400000).toISOString();
  const [hw] = must(await db.from('assignments').insert([
    { course_id: ds, title: 'HW1 - Implement a linked list', description: 'Complete the starter code and submit in class.', due_at: due(7), created_by: profKim },
    { course_id: courseId('BUS201', '2026-2'), title: 'Case study: brand positioning', description: 'Two pages, PDF.', due_at: due(12), created_by: profLee },
  ]).select('id'), 'assignments');
  must(await db.from('materials').update({ assignment_id: hw.id }).eq('storage_path', `${ds}/seed-w2-list.py`), 'attach');
}

console.log('\nDone. Sign in with the password from SEED_PASSWORD:');
console.log('  admin      admin@campus.local');
console.log('  professor  kim.prof@campus.local / lee.prof@campus.local');
console.log('  students   20243237, 20243238, 20242101, 20252102');
console.log('  student    20253001 (must change password on first login)');
