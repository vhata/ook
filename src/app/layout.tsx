import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "ook — a reading log",
    template: "%s · ook",
  },
  description: "What I'm reading, what I've read, and the bingo card I'm chasing.",
  openGraph: {
    title: "ook — a reading log",
    description: "What I'm reading, what I've read, and the bingo card I'm chasing.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <div className="flex-1">{children}</div>
        <footer className="border-t border-zinc-200 bg-zinc-50 py-6 text-center text-xs text-zinc-500 dark:border-zinc-900 dark:bg-zinc-950 dark:text-zinc-500">
          <p>
            <a
              href="https://github.com/vhata/ook"
              className="underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              ook
            </a>
            {" · "}rendered from a markdown vault
          </p>
        </footer>
      </body>
    </html>
  );
}
