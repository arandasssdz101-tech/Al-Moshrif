/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-25613826'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "registerSW.js",
    "revision": "402b66900e731ca748771b6fc5e7a068"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "bd12c8c2d7ed9cf0bd16f83d8b8341f8"
  }, {
    "url": "pwa-512x512.png",
    "revision": "a7adbf85352afab7f009d3f623c9aa29"
  }, {
    "url": "pwa-192x192.png",
    "revision": "53adff0530f59070790d78595a64743c"
  }, {
    "url": "index.html",
    "revision": "fdfc413204d70949ecd7f02ddd04b281"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "4414451604f16bf3a444f9c8f6ce9b67"
  }, {
    "url": "library/law-08-04.pdf",
    "revision": "2479bc21829c6888a0970a50e953b662"
  }, {
    "url": "library/field-guide-educational-duty.pdf",
    "revision": "fa3114bd0489984136211d735cae2663"
  }, {
    "url": "icons/school-app-icon.png",
    "revision": "a7adbf85352afab7f009d3f623c9aa29"
  }, {
    "url": "assets/web-DzK0Nccc.js",
    "revision": null
  }, {
    "url": "assets/web-DFJVNwZF.js",
    "revision": null
  }, {
    "url": "assets/web-BedGPD2y.js",
    "revision": null
  }, {
    "url": "assets/web-Bay7-Jet.js",
    "revision": null
  }, {
    "url": "assets/purify.es-CrhLeTK7.js",
    "revision": null
  }, {
    "url": "assets/pdf.worker.min-B5Yc7dP4.mjs",
    "revision": null
  }, {
    "url": "assets/inter-vietnamese-700-normal-DlLaEgI2.woff2",
    "revision": null
  }, {
    "url": "assets/inter-vietnamese-700-normal-BZaoP0fm.woff",
    "revision": null
  }, {
    "url": "assets/inter-vietnamese-500-normal-mJboJaSs.woff",
    "revision": null
  }, {
    "url": "assets/inter-vietnamese-500-normal-DOriooB6.woff2",
    "revision": null
  }, {
    "url": "assets/inter-vietnamese-400-normal-DMkecbls.woff2",
    "revision": null
  }, {
    "url": "assets/inter-vietnamese-400-normal-Bbgyi5SW.woff",
    "revision": null
  }, {
    "url": "assets/inter-latin-ext-700-normal-TidjK2hL.woff",
    "revision": null
  }, {
    "url": "assets/inter-latin-ext-700-normal-Ca8adRJv.woff2",
    "revision": null
  }, {
    "url": "assets/inter-latin-ext-500-normal-CV4jyFjo.woff2",
    "revision": null
  }, {
    "url": "assets/inter-latin-ext-500-normal-BxGbmqWO.woff",
    "revision": null
  }, {
    "url": "assets/inter-latin-ext-400-normal-C1nco2VV.woff2",
    "revision": null
  }, {
    "url": "assets/inter-latin-ext-400-normal-77YHD8bZ.woff",
    "revision": null
  }, {
    "url": "assets/inter-latin-700-normal-Yt3aPRUw.woff2",
    "revision": null
  }, {
    "url": "assets/inter-latin-700-normal-BLAVimhd.woff",
    "revision": null
  }, {
    "url": "assets/inter-latin-500-normal-Cerq10X2.woff2",
    "revision": null
  }, {
    "url": "assets/inter-latin-500-normal-BL9OpVg8.woff",
    "revision": null
  }, {
    "url": "assets/inter-latin-400-normal-CyCys3Eg.woff",
    "revision": null
  }, {
    "url": "assets/inter-latin-400-normal-C38fXH4l.woff2",
    "revision": null
  }, {
    "url": "assets/inter-greek-ext-700-normal-qfdV9bQt.woff2",
    "revision": null
  }, {
    "url": "assets/inter-greek-ext-700-normal-BoQ6DsYi.woff",
    "revision": null
  }, {
    "url": "assets/inter-greek-ext-500-normal-C4iEst2y.woff2",
    "revision": null
  }, {
    "url": "assets/inter-greek-ext-500-normal-2j5mBUwD.woff",
    "revision": null
  }, {
    "url": "assets/inter-greek-ext-400-normal-KugGGMne.woff",
    "revision": null
  }, {
    "url": "assets/inter-greek-ext-400-normal-DGGRlc-M.woff2",
    "revision": null
  }, {
    "url": "assets/inter-greek-700-normal-C3JjAnD8.woff2",
    "revision": null
  }, {
    "url": "assets/inter-greek-700-normal-BUv2fZ6O.woff",
    "revision": null
  }, {
    "url": "assets/inter-greek-500-normal-Xzm54t5V.woff",
    "revision": null
  }, {
    "url": "assets/inter-greek-500-normal-BIZE56-Y.woff2",
    "revision": null
  }, {
    "url": "assets/inter-greek-400-normal-q2sYcFCs.woff",
    "revision": null
  }, {
    "url": "assets/inter-greek-400-normal-B4URO6DV.woff2",
    "revision": null
  }, {
    "url": "assets/inter-cyrillic-ext-700-normal-LO58E6JB.woff",
    "revision": null
  }, {
    "url": "assets/inter-cyrillic-ext-700-normal-BjwYoWNd.woff2",
    "revision": null
  }, {
    "url": "assets/inter-cyrillic-ext-500-normal-BmqWE9Dz.woff",
    "revision": null
  }, {
    "url": "assets/inter-cyrillic-ext-500-normal-B0yAr1jD.woff2",
    "revision": null
  }, {
    "url": "assets/inter-cyrillic-ext-400-normal-DQukG94-.woff",
    "revision": null
  }, {
    "url": "assets/inter-cyrillic-ext-400-normal-BQZuk6qB.woff2",
    "revision": null
  }, {
    "url": "assets/inter-cyrillic-700-normal-DrXBdSj3.woff",
    "revision": null
  }, {
    "url": "assets/inter-cyrillic-700-normal-CjBOestx.woff2",
    "revision": null
  }, {
    "url": "assets/inter-cyrillic-500-normal-CxZf_p3X.woff",
    "revision": null
  }, {
    "url": "assets/inter-cyrillic-500-normal-BasfLYem.woff2",
    "revision": null
  }, {
    "url": "assets/inter-cyrillic-400-normal-obahsSVq.woff2",
    "revision": null
  }, {
    "url": "assets/inter-cyrillic-400-normal-HOLc17fK.woff",
    "revision": null
  }, {
    "url": "assets/index.es-DuXiE8jN.js",
    "revision": null
  }, {
    "url": "assets/index-mFCz1REl.js",
    "revision": null
  }, {
    "url": "assets/index-Do-BnqBx.js",
    "revision": null
  }, {
    "url": "assets/index-D94cQmPu.js",
    "revision": null
  }, {
    "url": "assets/index--rNgE2sH.css",
    "revision": null
  }, {
    "url": "assets/html2canvas.esm-DYnIztdk.js",
    "revision": null
  }, {
    "url": "assets/cairo-latin-ext-700-normal-htXca11Z.woff",
    "revision": null
  }, {
    "url": "assets/cairo-latin-ext-700-normal-Cscux539.woff2",
    "revision": null
  }, {
    "url": "assets/cairo-latin-ext-500-normal-DxXN6Mb5.woff2",
    "revision": null
  }, {
    "url": "assets/cairo-latin-ext-500-normal-De4OTi8O.woff",
    "revision": null
  }, {
    "url": "assets/cairo-latin-ext-400-normal-xCL67Y2R.woff2",
    "revision": null
  }, {
    "url": "assets/cairo-latin-ext-400-normal-C_BIE9Qe.woff",
    "revision": null
  }, {
    "url": "assets/cairo-latin-700-normal-C3GYtKbV.woff2",
    "revision": null
  }, {
    "url": "assets/cairo-latin-700-normal-6fcUy4Rc.woff",
    "revision": null
  }, {
    "url": "assets/cairo-latin-500-normal-DkdkMETP.woff",
    "revision": null
  }, {
    "url": "assets/cairo-latin-500-normal-D-WQsSKQ.woff2",
    "revision": null
  }, {
    "url": "assets/cairo-latin-400-normal-b1R3q6Pf.woff",
    "revision": null
  }, {
    "url": "assets/cairo-latin-400-normal-Dh7otpdh.woff2",
    "revision": null
  }, {
    "url": "assets/cairo-arabic-700-normal-D3nDedWX.woff2",
    "revision": null
  }, {
    "url": "assets/cairo-arabic-700-normal-CyOqhaeK.woff",
    "revision": null
  }, {
    "url": "assets/cairo-arabic-500-normal-DDl0i4Xv.woff2",
    "revision": null
  }, {
    "url": "assets/cairo-arabic-500-normal-BADfnM6v.woff",
    "revision": null
  }, {
    "url": "assets/cairo-arabic-400-normal-DN15VWMM.woff2",
    "revision": null
  }, {
    "url": "assets/cairo-arabic-400-normal-CAYwymWN.woff",
    "revision": null
  }, {
    "url": "assets/AbsenceDashboardScreen-DjcBAYlj.js",
    "revision": null
  }, {
    "url": "assets/aistudio/Screenshot_20261124-175524_3d5fe8b6.png",
    "revision": null
  }, {
    "url": "assets/aistudio/Screenshot_20261124-003536_a45897d4.png",
    "revision": null
  }, {
    "url": "assets/aistudio/Screenshot_20261123-200202_7fe64eda.png",
    "revision": null
  }, {
    "url": "assets/aistudio/Screenshot_20261122-212838_a0c2e5b9.png",
    "revision": null
  }, {
    "url": "assets/aistudio/IMG_20261125_104442_b89697e9.png",
    "revision": null
  }, {
    "url": "assets/aistudio/IMG_20261120_231736_1de1fb0a.png",
    "revision": null
  }, {
    "url": "assets/aistudio/IMG_20261120_230316_042bc4b1.png",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "4414451604f16bf3a444f9c8f6ce9b67"
  }, {
    "url": "pwa-192x192.png",
    "revision": "53adff0530f59070790d78595a64743c"
  }, {
    "url": "pwa-512x512.png",
    "revision": "a7adbf85352afab7f009d3f623c9aa29"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "bd12c8c2d7ed9cf0bd16f83d8b8341f8"
  }, {
    "url": "icons/school-app-icon.png",
    "revision": "a7adbf85352afab7f009d3f623c9aa29"
  }, {
    "url": "library/field-guide-educational-duty.pdf",
    "revision": "fa3114bd0489984136211d735cae2663"
  }, {
    "url": "library/law-08-04.pdf",
    "revision": "2479bc21829c6888a0970a50e953b662"
  }, {
    "url": "manifest.webmanifest",
    "revision": "fd2c80bd588b07710ae3dca0e458a6f7"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html")));
  workbox.registerRoute(({
    url
  }) => url.pathname.includes("/pdfjs/"), new workbox.CacheFirst({
    "cacheName": "pdfjs-static-assets",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 250,
      maxAgeSeconds: 31536000
    })]
  }), 'GET');

}));
