// Route-group layout for all Studio sections. It renders the persistent
// StudioShell, which stays mounted across child-route navigations (that's what
// preserves the live phone feed, AI wizard, video rows and scroll). The child
// `page.tsx` files are thin null markers — the shell renders the actual content
// based on the URL.
import { StudioShell } from '../StudioShell';

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StudioShell />
      {children}
    </>
  );
}
