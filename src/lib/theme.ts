import type { ThemeInstance } from 'vuetify';

export const VuetifyColorSchemeName = 'vuetify-color-scheme';
export type PrefersColorScheme = 'unspecified' | 'light' | 'dark';

export function applyColorScheme(theme: ThemeInstance, scheme: PrefersColorScheme) {
  if (scheme === 'unspecified') {
    theme.global.name.value = '';

    document.querySelectorAll('.color-responsive').forEach((element) => {
      element.classList.remove('color-responsive-dark', 'color-responsive-light');

      if (element instanceof HTMLObjectElement) {
        const innerElement = element.contentDocument?.documentElement;

        if (innerElement) {
          innerElement.classList.remove('color-responsive-dark', 'color-responsive-light');
        }
      }
    });
  } else {
    theme.global.name.value = scheme;

    document.querySelectorAll('.color-responsive').forEach((element) => {
      if (scheme === 'light') {
        element.classList.add('color-responsive-light');
        element.classList.remove('color-responsive-dark');
      } else {
        element.classList.add('color-responsive-dark');
        element.classList.remove('color-responsive-light');
      }

      if (element instanceof HTMLObjectElement) {
        const innerElement = element.contentDocument?.documentElement;

        if (!innerElement) {
          return;
        }

        if (scheme === 'light') {
          innerElement.classList.add('color-responsive-light');
          innerElement.classList.remove('color-responsive-dark');
        } else {
          innerElement.classList.add('color-responsive-dark');
          innerElement.classList.remove('color-responsive-light');
        }
      }
    });
  }
}

export function getPrefersColorScheme(): PrefersColorScheme {
  if (!window.matchMedia) {
    return 'unspecified';
  }

  if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }

  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }

  return 'unspecified';
}

export function toggleTheme(theme: ThemeInstance) {
  if (theme.global.current.value.dark) {
    if (getPrefersColorScheme() === 'light') {
      localStorage.removeItem(VuetifyColorSchemeName);
    } else {
      localStorage.setItem(VuetifyColorSchemeName, 'light');
    }

    applyColorScheme(theme, 'light');
  } else {
    if (getPrefersColorScheme() === 'dark') {
      localStorage.removeItem(VuetifyColorSchemeName);
    } else {
      localStorage.setItem(VuetifyColorSchemeName, 'dark');
    }

    applyColorScheme(theme, 'dark');
  }
}

export function reapplyTheme(theme: ThemeInstance) {
  const colorScheme = localStorage.getItem(VuetifyColorSchemeName);

  if (colorScheme === 'light') {
    applyColorScheme(theme, 'light');
  } else if (colorScheme === 'dark') {
    applyColorScheme(theme, 'dark');
  } else {
    if (getPrefersColorScheme() === 'dark') {
      applyColorScheme(theme, 'dark');
    } else {
      applyColorScheme(theme, 'light');
    }
  }
}
