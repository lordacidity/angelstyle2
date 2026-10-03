// How the Aiden views ask the section to show something: open the side panel
// on a person, a firm or a place, or put a form up. The section owns both, so
// any view can reach any other thing without knowing where it lives.

import type {
  AidenEvent, AidenFirm, AidenLink, AidenPerson, AidenPlace, AidenRound, EventKind,
} from '@/lib/aiden-types';

export type Selection = { type: 'person' | 'firm' | 'place'; id: string };

export type ModalState =
  | { kind: 'person'; initial?: AidenPerson; presetFirmId?: string | null; presetPlaceId?: string | null }
  | { kind: 'firm'; initial?: AidenFirm; presetPlaceId?: string | null }
  | { kind: 'place'; initial?: AidenPlace }
  | {
      kind: 'event';
      initial?: AidenEvent;
      presetKind?: EventKind;
      presetPeople?: string[];
      presetFirmId?: string | null;
      presetPlaceId?: string | null;
    }
  | { kind: 'link'; fromId: string; initial?: AidenLink }
  | { kind: 'round'; initial?: AidenRound; presetFirmIds?: string[]; presetCompany?: string };

export interface AidenNav {
  select: (s: Selection | null) => void;
  open: (m: ModalState) => void;
}
