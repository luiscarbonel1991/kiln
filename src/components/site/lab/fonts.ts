import { Archivo, Bricolage_Grotesque } from "next/font/google";

// Display faces the directions try, scoped to the landing's lab.
export const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["wdth"],
});

export const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});
