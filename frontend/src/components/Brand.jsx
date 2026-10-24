export default function Brand({ light = false, compact = false }) {
  return <span className={`inline-flex items-center gap-2.5 font-extrabold tracking-[-.045em] ${light ? 'text-white' : 'text-ink'}`}>
    <img src="/brand/campusmesh-mark.svg" alt="" className="size-10 shrink-0" />
    <span className={compact ? 'hidden sm:inline lg:hidden xl:inline' : undefined}>Campus<span className={light ? 'text-mesh-200' : 'text-mesh-600'}>Mesh</span></span>
  </span>;
}
