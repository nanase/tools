import { type ThemeDefinition } from 'vuetify';
import colors from 'vuetify/lib/util/colors.mjs';

const light: ThemeDefinition = {
  dark: false,
  colors: {
    background: '#FFFFFF',
    containerBackground: '#FFFFFF',
    primary: colors.indigo.base,
    secondary: colors.indigo.base,
    positive: colors.green.darken3,
    negative: colors.red.darken3,
  },
};

const dark: ThemeDefinition = {
  dark: true,
  colors: {
    background: '#121212',
    containerBackground: '#121212',
    primary: '#262852',
    secondary: colors.indigo.darken4,
    positive: colors.green.lighten2,
    negative: colors.red.lighten1,
  },
};

export const theme = {
  defaultTheme: 'light',
  themes: {
    light,
    dark,
  },
  variations: {
    colors: ['primary', 'secondary', 'positive', 'negative'],
    lighten: 0,
    darken: 0,
  },
};
