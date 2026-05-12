import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteFooter, BRAND_VARIANT } from "@/components/SiteFooter";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WitUS Inbox",
  description: "Cross-ecosystem form-submission triage surface.",
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: `/brand/${BRAND_VARIANT}/favicon.svg`, type: "image/svg+xml" },
      { url: `/brand/${BRAND_VARIANT}/favicon-32.png`, sizes: "32x32", type: "image/png" },
      { url: `/brand/${BRAND_VARIANT}/favicon-16.png`, sizes: "16x16", type: "image/png" },
    ],
    apple: `/brand/${BRAND_VARIANT}/favicon-180.png`,
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-50">
        <a
          href="#main"
          className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:rounded focus-visible:bg-sky-600 focus-visible:px-3 focus-visible:py-2 focus-visible:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
        >
          Skip to content
        </a>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
