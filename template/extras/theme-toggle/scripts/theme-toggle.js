// The saved theme is applied by the inline script in <head>, before the page renders.
export function initThemeToggle() {
  const toggleButton = document.querySelector('.theme-toggle');
  if (!toggleButton) return;

  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

  toggleButton.addEventListener('click', () => {
    const currentTheme = root.getAttribute('data-theme') ?? (prefersDark.matches ? 'dark' : 'light');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    root.setAttribute('data-theme', newTheme);
    try {
      localStorage.setItem('theme', newTheme);
    } catch {}
  });
}
