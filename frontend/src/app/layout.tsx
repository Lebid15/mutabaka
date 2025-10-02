import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "./theme-context";
import ThemeColorUpdater from "./theme-color-updater";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "مطابقة",
  description: "منصة مطابقة",
  icons: {
    icon: "/icons/favicon.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const cookieTheme = cookieStore.get("app-theme")?.value;
  const initialTheme = cookieTheme === "dark" ? "dark" : "light";
  const initialThemeColor = initialTheme === "dark" ? "#111B21" : "#FFFFFF";
  const appleStatusBarStyle = initialTheme === "dark" ? "black" : "default";

  return (
    <html lang="ar" dir="rtl" className="h-full" data-theme={initialTheme} suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content={initialThemeColor} />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#FFFFFF" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#111B21" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content={appleStatusBarStyle} />
      </head>
      <body suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased transition-colors duration-500`}>
        <ThemeProvider defaultTheme={initialTheme}>
          <ThemeColorUpdater />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
