import type { Metadata } from "next";
import { Geist, Geist_Mono, Anton, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
// Phonedeck UI styles, scoped to the .phonedeck-root wrapper so they don't
// leak into Studio's Tailwind-styled chrome.
import "./phonedeck/phonedeck-scoped.css";
import { RangeSliderSync } from "./components/RangeSliderSync";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const anton = Anton({
  variable: "--font-anton",
  subsets: ["latin"],
  weight: "400",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Distribution",
  description: "Create and export branded social media videos",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${anton.variable} ${inter.variable} ${jetbrainsMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <RangeSliderSync />
        {children}
      </body>
    </html>
  );
}
