import { redirect } from 'next/navigation';

/** Proqram bölməsi silinib — yalnız avadanlıq. */
export default function Page() {
  redirect('/mehsul/avadanliq/');
}
