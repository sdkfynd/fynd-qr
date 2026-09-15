export interface LogoPreset { id: string; name: string; src: string }
// Presets included in this release, using verified official assets.
export const logoPresets: LogoPreset[] = [
  { id: 'fynd', name: 'Fynd', src: `${import.meta.env.BASE_URL}logos/fynd.png` },
  { id: 'impetus', name: 'Impetus', src: `${import.meta.env.BASE_URL}logos/impetus.png` },
];
