import algeriaMapWatermarkDataUrl from '@/assets/algeria-map-watermark.png?inline';

export const REPUBLIC_NAME_AR = 'الجمهورية الجزائرية الديمقراطية الشعبية';
export const MINISTRY_NAME_AR = 'وزارة التربية الوطنية';
export const CARD_TITLE_AR = 'بطاقة التلميذ';

/**
 * Exact Algeria map watermark with wilaya borders and translucent red crescent & star
 * extracted directly from the official card design attachment.
 */
export const ALGERIA_MAP_WATERMARK_URL = algeriaMapWatermarkDataUrl;
export const ALGERIA_MAP_ASPECT_RATIO = 429 / 520;

/**
 * Official Algerian flag (3:2 ratio): green hoist, white fly, red crescent & 5-pointed star.
 */
export const ALGERIA_FLAG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" width="60" height="40">
  <rect x="0" y="0" width="30" height="40" fill="#006233"/>
  <rect x="30" y="0" width="30" height="40" fill="#ffffff"/>
  <path d="M34.6 12.1 A10 10 0 1 0 34.6 27.9 A8.1 8.1 0 1 1 34.6 12.1 Z" fill="#d21034"/>
  <polygon points="34.8,15.3 36.1,18.9 39.8,18.9 36.8,21.1 37.9,24.7 34.8,22.5 31.7,24.7 32.8,21.1 29.8,18.9 33.5,18.9" fill="#d21034"/>
  <rect x="0.4" y="0.4" width="59.2" height="39.2" fill="none" stroke="#64746b" stroke-width="0.8"/>
</svg>`;

/**
 * Stylized Ministry of National Education emblem (green olive/knowledge tree with national arcs).
 */
export const MINISTRY_EMBLEM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 56" width="64" height="56">
  <!-- Lush green canopy leaves -->
  <g fill="#157a3c">
    <ellipse cx="32" cy="11" rx="7" ry="4.5"/>
    <ellipse cx="22" cy="14" rx="7.5" ry="4.2" transform="rotate(-22 22 14)"/>
    <ellipse cx="42" cy="14" rx="7.5" ry="4.2" transform="rotate(22 42 14)"/>
    <ellipse cx="16" cy="21" rx="7" ry="4" transform="rotate(-35 16 21)"/>
    <ellipse cx="48" cy="21" rx="7" ry="4" transform="rotate(35 48 21)"/>
    <ellipse cx="24" cy="21" rx="6.5" ry="4" transform="rotate(-12 24 21)"/>
    <ellipse cx="40" cy="21" rx="6.5" ry="4" transform="rotate(12 40 21)"/>
    <ellipse cx="32" cy="19" rx="7" ry="4.5"/>
  </g>
  <g fill="#2e9d53" opacity="0.85">
    <ellipse cx="28" cy="14" rx="4.2" ry="2.4" transform="rotate(-14 28 14)"/>
    <ellipse cx="37" cy="15" rx="4.2" ry="2.4" transform="rotate(14 37 15)"/>
    <ellipse cx="20" cy="20" rx="4" ry="2.2" transform="rotate(-26 20 20)"/>
    <ellipse cx="44" cy="20" rx="4" ry="2.2" transform="rotate(26 44 20)"/>
    <ellipse cx="32" cy="24" rx="5.5" ry="2.6"/>
  </g>
  <!-- Trunk & branches -->
  <path d="M30.2 44 C30.4 36 30 30 23 25 M33.8 44 C33.6 36 34 30 41 25 M32 45 L32 23" fill="none" stroke="#1b4332" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M29.6 46 C30.5 39 30.8 33 32 28 C33.2 33 33.5 39 34.4 46 Z" fill="#1b4332"/>
  <!-- Sweeping national base arcs -->
  <path d="M8 46 Q20 39 32 45 Q44 50 56 44" fill="none" stroke="#006233" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M12 50 Q24 44 35 48 Q45 52 54 47" fill="none" stroke="#c81e3a" stroke-width="1.9" stroke-linecap="round"/>
</svg>`;

/**
 * Fine guilloche security wave lines radiating across the card background.
 */
export const GUILLOCHE_BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 260" width="600" height="260" preserveAspectRatio="none">
  <g fill="none" stroke="#9aa89c" stroke-width="0.65" stroke-opacity="0.3">
    <path d="M-20,18 Q95,95 190,260"/>
    <path d="M-20,30 Q105,105 205,260"/>
    <path d="M-20,42 Q115,115 220,260"/>
    <path d="M-20,54 Q125,125 235,260"/>
    <path d="M-20,66 Q135,135 250,260"/>
    <path d="M-20,78 Q145,145 265,260"/>
    <path d="M-20,90 Q155,155 280,260"/>
    <path d="M-20,102 Q165,165 295,260"/>
    <path d="M-20,114 Q175,175 310,260"/>
    <path d="M-20,126 Q185,185 325,260"/>
    <path d="M-20,138 Q195,195 340,260"/>
    <path d="M-20,150 Q205,205 355,260"/>
    <path d="M-20,162 Q215,215 370,260"/>
    <path d="M-20,174 Q225,225 385,260"/>
    <path d="M-20,186 Q235,235 400,260"/>
    <path d="M-20,198 Q245,245 415,260"/>
  </g>
  <g fill="none" stroke="#9aa89c" stroke-width="0.55" stroke-opacity="0.22">
    <path d="M-10,240 Q120,160 260,265"/>
    <path d="M-10,225 Q130,145 280,265"/>
    <path d="M-10,210 Q140,130 300,265"/>
    <path d="M-10,195 Q150,115 320,265"/>
    <path d="M-10,180 Q160,100 340,265"/>
    <path d="M-10,165 Q170,85 360,265"/>
    <path d="M-10,150 Q180,70 380,265"/>
    <path d="M40,-10 Q135,120 30,270"/>
    <path d="M58,-10 Q155,120 50,270"/>
    <path d="M76,-10 Q175,120 70,270"/>
    <path d="M94,-10 Q195,120 90,270"/>
    <path d="M112,-10 Q215,120 110,270"/>
  </g>
</svg>`;

/**
 * Clean student portrait frame silhouette placeholder (ready for physical passport photo attachment on printed cards).
 */
export const STUDENT_PHOTO_PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 102" width="88" height="102">
  <rect x="0" y="0" width="88" height="102" fill="#ffffff"/>
  <circle cx="44" cy="34" r="17" fill="#e1e4e2"/>
  <path d="M12 96 C12 72 25 60 44 60 C63 60 76 72 76 96 Z" fill="#e1e4e2"/>
  <rect x="33" y="29" width="22" height="16" rx="2.5" fill="none" stroke="#9aa39d" stroke-width="1.3"/>
  <circle cx="39" cy="34.5" r="2" fill="#9aa39d"/>
  <path d="M35 43 L41 37.5 L45 41 L49 37 L53 43" fill="none" stroke="#9aa39d" stroke-width="1.3" stroke-linejoin="round"/>
</svg>`;

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
