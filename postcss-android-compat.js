/**
 * PostCSS compatibility pass for older Android System WebViews (Chrome 55–87, Android 7–10)
 * while preserving full support for modern Android 11–16 WebViews:
 * 1. Emits `--color-<name>-rgb: R, G, B;` alongside `--color-<name>: R G B;` custom properties.
 * 2. Converts CSS Color Level 4 space-separated `rgb(R G B / A)` and `rgb(var(--color-X) / A)`
 *    (plus `hsl(...)`) to universally supported `rgba(..., A)` / `rgb(...)`.
 * 3. Adds physical `top` / `right` / `bottom` / `left` fallbacks before logical `inset`,
 *    `inset-block`, and symmetric `inset-inline` declarations.
 * 4. Rewrites any remaining `:is(.dark *)` / `:is(.dark)` dark-mode selectors for Chrome < 88.
 */

function splitTopLevelWhitespace(str) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (ch === '(') depth += 1;
    else if (ch === ')' && depth > 0) depth -= 1;

    if (depth === 0 && /\s/.test(ch)) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function splitTopLevelSlash(str) {
  let depth = 0;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (ch === '(') depth += 1;
    else if (ch === ')' && depth > 0) depth -= 1;
    else if (depth === 0 && ch === '/') {
      return [str.slice(0, i).trim(), str.slice(i + 1).trim()];
    }
  }
  return [str.trim(), null];
}

function convertColorFnBody(fnName, body) {
  const lower = fnName.toLowerCase();
  const [colorPart, alphaPart] = splitTopLevelSlash(body);

  // Transform inner `var(--color-foo)` -> `var(--color-foo-rgb)` when used inside rgb(...)
  const varMatch = /^var\(\s*(--color-[a-z0-9-]+?)\s*(?:,\s*([^)]+))?\)$/i.exec(colorPart);
  if (lower === 'rgb' && varMatch) {
    const varName = varMatch[1].endsWith('-rgb') ? varMatch[1] : `${varMatch[1]}-rgb`;
    const fallback = varMatch[2] ? `, ${varMatch[2].trim()}` : '';
    const rgbVar = `var(${varName}${fallback})`;
    if (alphaPart !== null) {
      return `rgba(${rgbVar}, ${alphaPart})`;
    }
    return `rgb(${rgbVar})`;
  }

  // Already comma-separated (e.g., `255, 255, 255` or `var(--x), 0.5`) -> upgrade `rgb(a, b, c, d)` to `rgba` if 4 args
  if (colorPart.includes(',') && alphaPart === null) {
    return `${fnName}(${body})`;
  }

  const channels = splitTopLevelWhitespace(colorPart);
  if (channels.length !== 3) {
    return `${fnName}(${body})`;
  }

  const joined = channels.join(', ');
  if (alphaPart !== null) {
    const outFn = lower === 'hsl' ? 'hsla' : 'rgba';
    return `${outFn}(${joined}, ${alphaPart})`;
  }
  return `${lower}(${joined})`;
}

export function transformColorFunctions(value) {
  if (!value || (!value.includes('rgb(') && !value.includes('hsl(') && !value.includes('RGB(') && !value.includes('HSL('))) {
    return value;
  }

  let out = '';
  let i = 0;
  while (i < value.length) {
    const slice = value.slice(i);
    const match = /^(rgb|hsl)\(/i.exec(slice);
    const prevChar = i > 0 ? value[i - 1] : '';
    if (match && !/[a-z0-9_-]/i.test(prevChar)) {
      const fnName = match[1];
      let j = i + fnName.length + 1;
      let depth = 1;
      while (j < value.length && depth > 0) {
        if (value[j] === '(') depth += 1;
        else if (value[j] === ')') depth -= 1;
        j += 1;
      }
      if (depth === 0) {
        const inner = value.slice(i + fnName.length + 1, j - 1);
        const transformedInner = transformColorFunctions(inner);
        out += convertColorFnBody(fnName, transformedInner);
        i = j;
        continue;
      }
    }
    out += value[i];
    i += 1;
  }
  return out;
}

export function rewriteDarkIsSelector(selector) {
  if (!selector || !selector.includes(':is(.dark')) {
    return selector;
  }
  return selector
    .split(',')
    .map((part) => {
      const trimmed = part.trim();
      const match = /^(.*):is\(\.dark\s*\*\)(.*)$/.exec(trimmed);
      if (match) {
        const prefix = match[1].trim();
        const suffix = match[2];
        return `.dark ${prefix}${suffix}`;
      }
      const selfMatch = /^(.*):is\(\.dark\)(.*)$/.exec(trimmed);
      if (selfMatch) {
        return `.dark${selfMatch[1]}${selfMatch[2]}`;
      }
      return trimmed;
    })
    .join(', ');
}

export default function androidWebViewCompatPlugin() {
  return {
    postcssPlugin: 'android-webview-compat',
    Once(root, { Declaration }) {
      root.walkRules((rule) => {
        if (rule.selector && rule.selector.includes(':is(.dark')) {
          rule.selector = rewriteDarkIsSelector(rule.selector);
        }

        const existingProps = new Set();
        rule.walkDecls((decl) => {
          existingProps.add(decl.prop);
        });

        const pendingAfter = [];
        const pendingBefore = [];

        rule.walkDecls((decl) => {
          // 1. Emit `--color-*-rgb: R, G, B;` alongside `--color-*: R G B;`
          if (decl.prop.startsWith('--color-') && !decl.prop.endsWith('-rgb')) {
            const triplet = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*$/.exec(decl.value);
            const rgbProp = `${decl.prop}-rgb`;
            if (triplet && !existingProps.has(rgbProp)) {
              existingProps.add(rgbProp);
              pendingAfter.push({
                anchor: decl,
                node: new Declaration({
                  prop: rgbProp,
                  value: `${triplet[1]}, ${triplet[2]}, ${triplet[3]}`,
                }),
              });
            }
          }

          // 2. Transform CSS Color Level 4 syntax into Chrome 55+ compatible rgb()/rgba()
          const nextValue = transformColorFunctions(decl.value);
          if (nextValue !== decl.value) {
            decl.value = nextValue;
          }

          // 3. Physical fallbacks for inset / inset-block / symmetric inset-inline (Chrome < 87)
          if (decl.prop === 'inset') {
            const parts = splitTopLevelWhitespace(decl.value);
            let t, r, b, l;
            if (parts.length === 1) {
              t = r = b = l = parts[0];
            } else if (parts.length === 2) {
              t = b = parts[0];
              r = l = parts[1];
            } else if (parts.length === 3) {
              t = parts[0];
              r = l = parts[1];
              b = parts[2];
            } else if (parts.length === 4) {
              [t, r, b, l] = parts;
            }
            if (t !== undefined) {
              const pairs = [
                ['top', t],
                ['right', r],
                ['bottom', b],
                ['left', l],
              ];
              for (const [prop, val] of pairs) {
                if (!existingProps.has(prop)) {
                  existingProps.add(prop);
                  pendingBefore.push({
                    anchor: decl,
                    node: new Declaration({ prop, value: val }),
                  });
                }
              }
            }
          } else if (decl.prop === 'inset-block') {
            const parts = splitTopLevelWhitespace(decl.value);
            if (parts.length >= 1 && parts.length <= 2) {
              const t = parts[0];
              const b = parts[1] ?? parts[0];
              for (const [prop, val] of [
                ['top', t],
                ['bottom', b],
              ]) {
                if (!existingProps.has(prop)) {
                  existingProps.add(prop);
                  pendingBefore.push({
                    anchor: decl,
                    node: new Declaration({ prop, value: val }),
                  });
                }
              }
            }
          } else if (decl.prop === 'inset-inline') {
            const parts = splitTopLevelWhitespace(decl.value);
            if (parts.length === 1) {
              const side = parts[0];
              for (const [prop, val] of [
                ['left', side],
                ['right', side],
              ]) {
                if (!existingProps.has(prop)) {
                  existingProps.add(prop);
                  pendingBefore.push({
                    anchor: decl,
                    node: new Declaration({ prop, value: val }),
                  });
                }
              }
            }
          }
        });

        for (const item of pendingBefore) {
          item.anchor.before(item.node);
        }
        for (const item of pendingAfter) {
          item.anchor.after(item.node);
        }
      });
    },
  };
}

androidWebViewCompatPlugin.postcss = true;
