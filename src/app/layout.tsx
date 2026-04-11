import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Jura } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const jura = Jura({
  variable: "--font-jura",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Starlink Pass Simulator",
  description: "Hardware-first simulation of a Starlink satellite pass over a ground station",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${jura.variable} h-full antialiased`}
    >
      <body className="h-screen overflow-hidden flex flex-col">
        {children}
        <div className="noise-overlay" />
      </body>
    </html>
  );
}
