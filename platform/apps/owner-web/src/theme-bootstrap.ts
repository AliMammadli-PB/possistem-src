let initialTheme = 'light';
try {
  const saved =
    localStorage.getItem('possistem-portal-theme') ?? localStorage.getItem('milioner-portal-theme');
  if (saved === 'dark') initialTheme = 'dark';
} catch {
  // Dark is the product default when storage is unavailable.
}
document.documentElement.dataset.theme = initialTheme;
document.documentElement.style.colorScheme = initialTheme;
const market = location.pathname.startsWith('/marketpos');
document.querySelector('meta[name="theme-color"]')?.setAttribute(
  'content',
  initialTheme === 'light' ? (market ? '#0a4f9c' : '#f8fafc') : market ? '#07090d' : '#020617',
);
