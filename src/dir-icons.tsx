// Arrows that point "forward" in reading order. In a right-to-left language
// (Arabic) they mirror, so "next" still points the way the text flows.
// Import these instead of the plain Phosphor arrows for any "go / next / back"
// arrow. Compass-like arrows (map, demo pad) must keep using Phosphor directly.
import {
  ArrowLeft as PhArrowLeft,
  ArrowRight as PhArrowRight,
  CaretRight as PhCaretRight,
  type IconProps,
} from "@phosphor-icons/react";
import { rtl } from "./i18n";

export const ArrowRight = (props: IconProps) => <PhArrowRight mirrored={rtl} {...props} />;
export const ArrowLeft = (props: IconProps) => <PhArrowLeft mirrored={rtl} {...props} />;
export const CaretRight = (props: IconProps) => <PhCaretRight mirrored={rtl} {...props} />;
