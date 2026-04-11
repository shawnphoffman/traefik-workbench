import type { Metadata, Viewport } from "next";
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

const APP_NAME = "Traefik Workbench";
const APP_DESCRIPTION =
  "A lightweight, self-hosted, web-based YAML editor with a 3-pane interface for managing Traefik dynamic configuration files without SSH. Optional Claude AI integration for completion, validation, and formatting.";
const APP_TAGLINE = "YAML configuration editor for Traefik";

export const metadata: Metadata = {
  // The app is self-hosted, so we don't have a canonical absolute URL
  // baked in. Most metadata still works without one — Next will emit
  // relative URLs for /logo.png etc. and crawlers will resolve them
  // against whatever origin is serving the page.
  applicationName: APP_NAME,
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  keywords: [
    "Traefik",
    "YAML",
    "editor",
    "self-hosted",
    "Docker",
    "reverse proxy",
    "configuration",
    "Monaco",
    "Next.js",
  ],
  authors: [{ name: "Shawn Hoffman", url: "https://github.com/shawnphoffman" }],
  creator: "Shawn Hoffman",
  // Next auto-discovers favicon.ico, icon.svg and apple-icon.png from
  // src/app — declaring them explicitly here is just belt-and-braces
  // so the link tags emit in a predictable order.
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: { url: "/apple-icon.png" },
  },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: APP_NAME,
    description: APP_TAGLINE,
    images: [
      {
        url: "/logo.png",
        width: 1024,
        height: 884,
        alt: `${APP_NAME} logo`,
      },
    ],
  },
  twitter: {
    card: "summary",
    title: APP_NAME,
    description: APP_TAGLINE,
    images: ["/logo.png"],
  },
  robots: {
    // Self-hosted instances shouldn't be indexed by search engines.
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#2fb1cc",
  colorScheme: "dark",
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
      <body className="flex h-full flex-col overflow-hidden bg-neutral-950 text-neutral-100">
        {children}
      </body>
    </html>
  );
}
