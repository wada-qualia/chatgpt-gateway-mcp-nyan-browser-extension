export const nekoAssets = {
  waiting: [
    "assets/neko/waiting/icon_02.png",
    "assets/neko/waiting/icon_03.png",
    "assets/neko/waiting/icon_04.png",
    "assets/neko/waiting/icon_06.png",
    "assets/neko/waiting/icon_11.png",
    "assets/neko/waiting/icon_13.png",
    "assets/neko/waiting/icon_14.png",
    "assets/neko/waiting/icon_22.png",
    "assets/neko/waiting/icon_23.png",
    "assets/neko/waiting/icon_25.png",
    "assets/neko/waiting/icon_27.png",
    "assets/neko/waiting/icon_29.png",
    "assets/neko/waiting/icon_31.png",
    "assets/neko/waiting/icon_36.png",
    "assets/neko/waiting/icon_37.png",
    "assets/neko/waiting/icon_38.png",
    "assets/neko/waiting/icon_40.png",
    "assets/neko/waiting/icon_41.png",
    "assets/neko/waiting/icon_44.png",
    "assets/neko/waiting/icon_50.png",
    "assets/neko/waiting/icon_51.png",
    "assets/neko/waiting/icon_52.png",
    "assets/neko/waiting/icon_56.png",
    "assets/neko/waiting/icon_58.png",
    "assets/neko/waiting/icon_59.png",
    "assets/neko/waiting/icon_63.png",
  ],
  interesting: [
    "assets/neko/interesting/icon_01.png",
    "assets/neko/interesting/icon_05.png",
    "assets/neko/interesting/icon_07.png",
    "assets/neko/interesting/icon_08.png",
    "assets/neko/interesting/icon_09.png",
    "assets/neko/interesting/icon_15.png",
    "assets/neko/interesting/icon_16.png",
    "assets/neko/interesting/icon_17.png",
    "assets/neko/interesting/icon_18.png",
    "assets/neko/interesting/icon_21.png",
    "assets/neko/interesting/icon_24.png",
    "assets/neko/interesting/icon_26.png",
    "assets/neko/interesting/icon_30.png",
    "assets/neko/interesting/icon_32.png",
    "assets/neko/interesting/icon_33.png",
    "assets/neko/interesting/icon_34.png",
    "assets/neko/interesting/icon_35.png",
    "assets/neko/interesting/icon_39.png",
    "assets/neko/interesting/icon_42.png",
    "assets/neko/interesting/icon_43.png",
    "assets/neko/interesting/icon_45.png",
    "assets/neko/interesting/icon_53.png",
    "assets/neko/interesting/icon_57.png",
    "assets/neko/interesting/icon_60.png",
    "assets/neko/interesting/icon_62.png",
  ],
} as const;

export type NekoMood = keyof typeof nekoAssets;
export type NekoAsset = (typeof nekoAssets)[NekoMood][number];

export function pickNekoAsset(
  mood: NekoMood,
  random: () => number = Math.random,
): NekoAsset {
  const assets = nekoAssets[mood];
  const sample = random();
  const normalized = Number.isFinite(sample)
    ? Math.min(Math.max(sample, 0), 1 - Number.EPSILON)
    : 0;
  const index = Math.floor(normalized * assets.length);
  return assets[index] as NekoAsset;
}
