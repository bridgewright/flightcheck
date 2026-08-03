import { SCREENSHOTS } from "./copy";
import ScreenFrame from "./ScreenFrame";

// The four screens a buyer wants to see before paying: the compiled bar, the
// room they will sit in, the report they will get, and what progress across
// six sessions looks like. Framed, because framed screens read as a product
// and raw crops read as decoration.

export default function Showcase() {
  return (
    <div className="grid gap-8 sm:grid-cols-2">
      {SCREENSHOTS.map((shot) => (
        <ScreenFrame
          key={shot.key}
          title={shot.title}
          caption={shot.caption}
          src={shot.src}
        />
      ))}
    </div>
  );
}
