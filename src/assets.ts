// Все ресурсы импортируются как модули, чтобы сборка `vite-plugin-singlefile`
// могла вшить их в один index.html (base64). Игра запускается даже с file://
// и не делает ни одного внешнего запроса.
import asphaltDiff from './assets/asphalt-diff.webp';
import asphaltNormal from './assets/asphalt-nor_gl.webp';
import asphaltRough from './assets/asphalt-rough.webp';
import pavingDiff from './assets/paving-diff.webp';
import pavingNormal from './assets/paving-nor_gl.webp';
import skin from './assets/skin.jpg';
import skinNormal from './assets/skin-normal.jpg';

export const ASSETS = {
  asphaltDiff,
  asphaltNormal,
  asphaltRough,
  pavingDiff,
  pavingNormal,
  skin,
  skinNormal,
} as const;
