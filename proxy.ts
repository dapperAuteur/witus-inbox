import { withAuth } from "next-auth/middleware";

const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();

export default withAuth({
  callbacks: {
    authorized: ({ token }) => {
      const email = typeof token?.email === "string" ? token.email.toLowerCase() : null;
      return Boolean(adminEmail && email === adminEmail);
    },
  },
  pages: { signIn: "/auth/sign-in" },
});

export const config = {
  matcher: ["/inbox/:path*", "/api/submissions/:path*"],
};
