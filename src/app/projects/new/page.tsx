import { connection } from "next/server";
import { NewProjectFlow } from "@/components/projects/new-project-flow";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { listProducts } from "@/server/product-repository";

// New project (ROADMAP screen 2): product -> type -> destinations -> plan ->
// Start. Rendered per request (it reads the maker's products).
export default async function NewProjectPage() {
  await connection();
  const products = await listProducts();
  return (
    <div className="flex min-h-full flex-col">
      <ProjectsHeader />
      <NewProjectFlow initialProducts={products} />
    </div>
  );
}
