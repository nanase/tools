import { createApp, type App } from 'vue';

import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import { createVuetify } from 'vuetify';
import { theme } from '@/theme';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

import '@/style/main.scss';

export function createAndMount(
  rootContainer: Parameters<App<Element | string>['mount']>[0],
  rootComponent: Parameters<typeof createApp>[0],
) {
  const vuetify = createVuetify({
    components,
    directives,
    icons: {
      defaultSet: 'mdi',
    },
    theme,
  });
  const app = createApp(rootComponent);
  app.use(vuetify);
  app.mount(rootContainer);
}
