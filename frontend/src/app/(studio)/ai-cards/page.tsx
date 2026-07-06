import { redirect } from 'next/navigation';

// The AI Cards wizard was absorbed into the Carousel section (its "From a
// name" and "Trending" flows). Keep old links/bookmarks working.
export default function Page() {
  redirect('/carousel');
}
