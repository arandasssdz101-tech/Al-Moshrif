import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import androidWebViewCompatPlugin from './postcss-android-compat.js';

export default {
  plugins: [tailwindcss(), autoprefixer(), androidWebViewCompatPlugin()],
};
