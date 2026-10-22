import { LockKeyhole, Printer } from "lucide-react";
export default function PrintSoon() {
  return (
    <main className="page-shell text-center">
      <div className="panel mx-auto max-w-lg p-10">
        <Printer className="mx-auto text-mesh-600" size={36} />
        <h1 className="page-title mt-5">Campus Print</h1>
        <p className="page-copy">Upload, print and collect on campus.</p>
        <span className="mt-6 inline-flex items-center gap-2 rounded-full bg-paper px-4 py-2 text-sm text-ink/60">
          <LockKeyhole size={15} /> Coming soon
        </span>
      </div>
    </main>
  );
}
