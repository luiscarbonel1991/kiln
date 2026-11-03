import { ArrowRight, Check, MessageSquare } from "lucide-react";
import Link from "next/link";
import { StoryChapter } from "@/components/home/story-chapter";
import { StoryDestinations } from "@/components/home/story-destinations";
import { StoryLooks } from "@/components/home/story-looks";
import { at } from "@/components/home/story-part";
import {
  DesignStage,
  ExactStage,
  ScenesStage,
  SpecStage,
  WordsStage,
} from "@/components/home/story-stages";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import type { HomeStory } from "@/lib/home-story";

// Home's story (ROADMAP "Toward a stable version", step 3): one product's way
// through Kiln, chapter by chapter: its spec, its designs, its exact frames,
// its scenes, its looks, its words, and everywhere it sells. Told with the
// maker's showcase project, or with the sample product.
export function Story({ story }: { story: HomeStory }) {
  const sample = story.project === null;
  const lead = story.scenes[0];
  const frame = lead ? (
    // biome-ignore lint/performance/noImgElement: the maker's approved take, as stored
    <img src={lead.url} alt="" loading="lazy" />
  ) : story.exact[0] ? (
    <ExactSlotArt view={story.exact[0].view} plate={story.plate} />
  ) : null;
  return (
    <div id="story" className="flex scroll-mt-20 flex-col gap-24 sm:gap-32">
      <header className="flex max-w-[680px] flex-col gap-3">
        <p className="font-sans text-[0.656rem] font-bold uppercase tracking-[0.18em] text-prov-brand">
          How it works
        </p>
        <h2
          className="font-serif text-[2rem] font-semibold leading-[1.1] text-foreground sm:text-[2.5rem]"
          style={{ fontVariationSettings: "'opsz' 144" }}
        >
          {sample
            ? "One product, from its spec to every place it sells."
            : `${story.product.name}, from its spec to every place it sells.`}
        </h2>
        <p className="font-sans text-[0.9375rem] leading-relaxed text-on-surface-mid">
          {sample
            ? "Shown here with a sample product. Yours tells the same story with its own frames, scenes and words."
            : `Told with ${story.project?.name ?? "your project"}: your own frames, scenes and words.`}
        </p>
      </header>

      <StoryChapter
        id="product"
        number={1}
        eyebrow="The product"
        title="It starts with your product, not a photo."
        stage={<SpecStage product={story.product} sample={sample} />}
      >
        <p>
          Its size, material, finish, colours and what the buyer personalizes,
          kept in one spec. Every frame, scene and word Kiln makes is drawn from
          it; change it once and each project that uses it knows.
        </p>
      </StoryChapter>

      <StoryChapter
        id="design"
        number={2}
        eyebrow="Designs"
        title="A drawing becomes a clean SVG."
        flip
        stage={<DesignStage design={story.design} />}
      >
        <p>
          Start from a sketch or a photo. An image model redraws it as clean
          line art, and Kiln traces that into a vector, free, ready to become a
          product of its own.
        </p>
      </StoryChapter>

      <StoryChapter
        id="frames"
        number={3}
        eyebrow="Exact frames"
        title="Frames drawn from the spec, free and exact."
        stage={
          <ExactStage
            frames={story.exact}
            plate={story.plate}
            sample={sample}
          />
        }
      >
        <p>
          Colour options, size and scale, how to personalize: drawn from your
          product's own numbers, at no cost and at every channel's size. No
          model guesses your dimensions.
        </p>
      </StoryChapter>

      <StoryChapter
        id="scenes"
        number={4}
        eyebrow="Scenes"
        title="Scenes only a photo can show, each take checked."
        flip
        stage={<ScenesStage scenes={story.scenes} product={story.product} />}
      >
        <p>
          Where a buyer needs to see it at home, an image model sets the scene
          with your product as the anchor. Kiln reads every take's text and
          letterforms against your product before you see it.
        </p>
        <p>
          Approve it, reject it with a reason, or tune the scene: a new take is
          one click, and its cost shows before anything runs.
        </p>
      </StoryChapter>

      <StoryChapter
        id="looks"
        number={5}
        eyebrow="Every look"
        title="Every colour, without a reshoot."
        stage={
          <StoryLooks
            looks={story.looks.map(({ key, name, face }) => ({
              key,
              name,
              face,
            }))}
            frames={story.looks.map((look) => (
              <ExactSlotArt key={look.key} view={look.view} />
            ))}
            sample={sample}
          />
        }
      >
        <p>
          Show each colour and style it comes in: the frames redraw themselves
          and the scenes follow, so a new colour is a click, not a photoshoot.
        </p>
      </StoryChapter>

      {story.words ? (
        <StoryChapter
          id="words"
          number={6}
          eyebrow="The words"
          title="Listing text, held to each channel's rules."
          flip
          stage={<WordsStage words={story.words} sample={sample} />}
        >
          <p>
            Title, description, tags and materials, drafted from the spec for
            free. A text model rewrites the prose when you ask, and every field
            is checked against the channel's limits before it goes anywhere.
          </p>
        </StoryChapter>
      ) : null}

      <StoryChapter
        id="everywhere"
        number={story.words ? 7 : 6}
        eyebrow="Everywhere it sells"
        title="One project, every place it sells."
        stage={
          <div className="flex flex-col gap-5">
            <StoryDestinations
              destinations={story.destinations}
              frame={frame}
            />
            <AgentsCoda />
          </div>
        }
      >
        <p>
          The same work sized for each channel, a zip ready for any of them, a
          draft straight into your Etsy shop, and the numbers read back 30 days
          later.
        </p>
        <p className="font-semibold text-foreground">
          Kiln never publishes: you do.
        </p>
      </StoryChapter>
    </div>
  );
}

// The agents, in a line: asked in words, they read the work and propose;
// anything paid or sent waits for the maker's click.
function AgentsCoda() {
  return (
    <div className="flex flex-col gap-2.5 rounded-card bg-surface-soft p-5 sm:p-6">
      <p
        className="story-part flex items-center gap-2 self-end rounded-render rounded-br-badge bg-card px-3.5 py-2 font-sans text-[0.85rem] text-foreground shadow-card"
        style={at(9)}
      >
        <MessageSquare className="size-3.5 text-on-surface-mid" />
        Send this to my shop as a draft.
      </p>
      <div
        className="story-part flex flex-col gap-2 self-start rounded-render rounded-bl-badge bg-card px-4 py-3 shadow-card"
        style={at(10)}
      >
        <span className="font-sans text-[0.594rem] font-bold uppercase tracking-[0.18em] text-prov-brand">
          Waits for your ok
        </span>
        <span className="font-sans text-[0.85rem] text-foreground">
          A new draft from this project: its text, approved photos and price.
        </span>
        <span className="flex gap-2" aria-hidden>
          <span className="inline-flex items-center gap-1 rounded-field bg-primary px-2.5 py-1 font-sans text-[0.75rem] font-semibold text-primary-foreground">
            <Check className="size-3" /> Approve
          </span>
          <span className="inline-flex items-center rounded-field px-2.5 py-1 font-sans text-[0.75rem] font-semibold text-on-surface-mid">
            Not now
          </span>
        </span>
      </div>
      <p
        className="story-part font-sans text-[0.8rem] text-on-surface-mid"
        style={at(11)}
      >
        Or ask in words: Kiln's agents read your work and propose; anything paid
        or sent waits for your click.{" "}
        <Link
          href="/chat"
          className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
        >
          Open the chat <ArrowRight className="size-3" />
        </Link>
      </p>
    </div>
  );
}
