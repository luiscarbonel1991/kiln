import { permanentRedirect } from "next/navigation";

// The public page moved to the home page.
export default function WelcomePage() {
  permanentRedirect("/");
}
