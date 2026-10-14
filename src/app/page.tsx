import { redirect } from 'next/navigation';
import { homeFor, requireUser } from '@/lib/auth';

/** "/" simply forwards each role to its own home. */
export default async function Home() {
  const user = await requireUser();
  redirect(homeFor(user.role));
}
