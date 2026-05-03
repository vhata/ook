import type { Metadata } from "next";
import { Source_Serif_4, Inter_Tight, IBM_Plex_Mono } from "next/font/google";
import { Suspense } from "react";
import Controls from "@/components/Controls";
import "./globals.css";

const serif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const sans = Inter_Tight({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ook — a reading journal",
    template: "%s · ook",
  },
  description: "What I'm reading, what I've finished, and the bingo card I'm chasing.",
  openGraph: {
    title: "ook — a reading journal",
    description: "What I'm reading, what I've finished, and the bingo card I'm chasing.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${serif.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="bg-bg text-ink font-sans flex min-h-full flex-col">
        <Suspense fallback={null}>
          <Controls />
        </Suspense>
        <div className="flex-1">{children}</div>
        <footer className="border-rule text-ink-soft border-t py-6 text-center text-xs">
          <p>
            <a
              href="https://github.com/vhata/ook"
              className="hover:text-ink underline underline-offset-2"
            >
              ook
            </a>
            {" · "}built from a markdown vault
          </p>
        </footer>
      </body>
    </html>
  );
}
