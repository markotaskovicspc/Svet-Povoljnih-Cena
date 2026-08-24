import Link from "next/link";
import { Mail, MapPin } from "lucide-react";
import type {
  ContactChannel,
  ContactPageWidgetData,
} from "@/lib/cms/contact-page";

function channelHref(channel: ContactChannel) {
  if (channel.id === "email") return `mailto:${channel.value}`;
  return `https://maps.google.com/?q=${encodeURIComponent(channel.value)}`;
}

export function ContactChannels({ data }: { data: ContactPageWidgetData }) {
  const channels = data.channels.filter((channel) => channel.enabled);

  if (!channels.length) return null;

  return (
    <ul className="not-prose grid gap-4 sm:grid-cols-2">
      {channels.map((channel) => {
        const Icon = channel.id === "email" ? Mail : MapPin;
        return (
          <li
            key={channel.id}
            className="bg-surface ring-border/60 rounded-2xl p-6 ring-1"
          >
            <div className="flex items-start gap-3">
              <span className="bg-muted-bg text-walnut grid size-10 shrink-0 place-items-center rounded-xl">
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[11px] tracking-[0.18em] text-ink-500 uppercase">
                  {channel.label}
                </p>
                <Link
                  href={channelHref(channel)}
                  className="font-display mt-1 block text-lg break-words text-ink-900 hover:text-walnut"
                >
                  {channel.value}
                </Link>
                {channel.note ? (
                  <p className="mt-1 text-xs text-ink-500">{channel.note}</p>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
