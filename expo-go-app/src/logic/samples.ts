import type { Pack } from "./types";

/**
 * Fictional sample trainings from the FirstDay fixtures (fixtures/transcripts).
 * They are labelled "Sample" in the app and can be deleted.
 */
export function samplePacks(now: number): Pack[] {
  return [
    {
      id: "sample-library",
      title: "Library welcome desk",
      place: "Library",
      trainer: "Maya",
      sample: true,
      createdAt: now,
      source:
        "Maya: This is a fictional training conversation for the FirstDay demo.\nWhen a visitor borrows a reading kit, record the kit number in the blue ledger.\nIf a visitor collects a reserved map, ask for the collection code before handing it over.\nWhenever a visitor returns a torn poster, place it in the green repair tray.\nIf a visitor asks for an extension, maybe allow another day.",
      rules: [
        {
          id: "lib-kit",
          situation: "A visitor wants to borrow a reading kit.",
          customerLine: "Hi! Can I take this reading kit home for the week?",
          action: "Record the kit number in the blue ledger.",
          keywords: ["kit", "number", "blue", "ledger"],
          quote: "When a visitor borrows a reading kit, record the kit number in the blue ledger.",
          distractors: ["Write their name on a sticky note and hand it over.", "Scan it and hand it over. No notes needed."],
        },
        {
          id: "lib-map",
          situation: "A visitor is collecting a map they reserved.",
          customerLine: "I'm here to pick up the map I reserved.",
          action: "Ask for the collection code before handing it over.",
          keywords: ["collection", "code"],
          quote: "If a visitor collects a reserved map, ask for the collection code before handing it over.",
          distractors: ["Hand it over once they tell you their name.", "Check their library card, then hand it over."],
        },
        {
          id: "lib-poster",
          situation: "A visitor returns a torn poster.",
          customerLine: "Sorry… this poster got a little torn on the way back.",
          action: "Place it in the green repair tray.",
          keywords: ["green", "repair", "tray"],
          quote: "Whenever a visitor returns a torn poster, place it in the green repair tray.",
          distractors: ["Put it back on the poster rack.", "Drop it in the returns bin with everything else."],
        },
      ],
      questions: ["Maya said “maybe allow another day” for extensions. What's the actual rule?"],
      pendingUpdates: [
        {
          ruleId: "lib-kit",
          newAction: "Record the kit number in the orange ledger.",
          newKeywords: ["kit", "number", "orange", "ledger"],
          quote: "Update: When a visitor borrows a reading kit, record the kit number in the orange ledger.",
        },
      ],
    },
    {
      id: "sample-studio",
      title: "Art studio reception",
      place: "Art studio",
      trainer: "Maya",
      sample: true,
      createdAt: now - 1,
      source:
        "Maya: These are fictional reception procedures for a practice session.\nWhenever a guest collects a sketch pack, ask for the booking reference.\nWhen a guest borrows a display stand, write the stand number on the checkout sheet.\nIf a guest returns a stained apron, place it in the yellow laundry basket.",
      rules: [
        {
          id: "st-sketch",
          situation: "A guest is collecting a sketch pack.",
          customerLine: "Hey, I booked a sketch pack. Is it ready?",
          action: "Ask for the booking reference.",
          keywords: ["booking", "reference"],
          quote: "Whenever a guest collects a sketch pack, ask for the booking reference.",
          distractors: ["Hand them any pack from the shelf.", "Ask them to show photo ID."],
        },
        {
          id: "st-stand",
          situation: "A guest wants to borrow a display stand.",
          customerLine: "Could I borrow one of the display stands for my piece?",
          action: "Write the stand number on the checkout sheet.",
          keywords: ["stand", "number", "checkout", "sheet"],
          quote: "When a guest borrows a display stand, write the stand number on the checkout sheet.",
          distractors: ["Let them take it. Stands always come back.", "Write their name on the whiteboard."],
        },
        {
          id: "st-apron",
          situation: "A guest returns a stained apron.",
          customerLine: "Here's my apron back. Sorry, there's paint all over it.",
          action: "Place it in the yellow laundry basket.",
          keywords: ["yellow", "laundry", "basket"],
          quote: "If a guest returns a stained apron, place it in the yellow laundry basket.",
          distractors: ["Hang it back on the hook.", "Rinse it in the studio sink."],
        },
      ],
      questions: [],
      pendingUpdates: [
        {
          ruleId: "st-stand",
          newAction: "Write the stand number in the checkout notebook.",
          newKeywords: ["stand", "number", "checkout", "notebook"],
          quote: "Update: When a guest borrows a display stand, write the stand number in the checkout notebook.",
        },
      ],
    },
    {
      id: "sample-bookshop",
      title: "Bookshop first shift",
      place: "Bookshop",
      trainer: "Your manager",
      sample: true,
      createdAt: now - 2,
      source:
        "We hold each customer reservation for five calendar days, counting the day we set it aside as day one.\nBefore you hand over a reserved book, ask for both the reservation name and the phone number on the reservation.\nIf a customer returns a damaged book, place it on the red returns cart in the back room before you issue the refund.",
      rules: [
        {
          id: "bk-hold",
          situation: "A customer asks if their reservation is still being held.",
          customerLine: "I reserved a book four days ago. Is it still being held?",
          action: "Count the set-aside day as day one. Reservations are held for five calendar days.",
          keywords: ["day", "one", "five"],
          quote: "We hold each customer reservation for five calendar days, counting the day we set it aside as day one.",
          distractors: ["Reservations last three days, so it has expired.", "Start counting the day after it was set aside; it's held for a week."],
        },
        {
          id: "bk-collect",
          situation: "A customer is collecting a reserved book.",
          customerLine: "Hi, I'm here for the book I put on hold.",
          action: "Ask for both the reservation name and the phone number before handing it over.",
          keywords: ["name", "phone", "number"],
          quote: "Before you hand over a reserved book, ask for both the reservation name and the phone number on the reservation.",
          distractors: ["Ask for their name only, then hand it over.", "Hand it over. They know which book it is."],
        },
        {
          id: "bk-damage",
          situation: "A customer returns a damaged book for a refund.",
          customerLine: "This book fell apart on day one. Can I get my money back?",
          action: "Put the book on the red returns cart in the back room, then issue the refund.",
          keywords: ["red", "cart", "back", "refund"],
          quote: "If a customer returns a damaged book, place it on the red returns cart in the back room before you issue the refund.",
          distractors: ["Issue the refund first, then shelve the book.", "Keep it under the front counter until closing."],
        },
      ],
      questions: [],
      pendingUpdates: [
        {
          ruleId: "bk-hold",
          newAction: "Count the set-aside day as day one. Reservations are now held for seven calendar days.",
          newKeywords: ["day", "one", "seven"],
          quote: "Starting today, we hold each customer reservation for seven calendar days, counting the day we set it aside as day one.",
        },
      ],
    },
  ];
}

/** A fictional everyday conversation, so Today isn't empty on first launch. */
export const SAMPLE_CONVERSATION = {
  title: "Sample · Chat with Dana before shift",
  text: [
    "Dana: Morning! Quick heads up before your shift.",
    "Dana: Can you restock the receipt paper by noon?",
    "Me: Sure. I'll also email Priya the schedule tomorrow at 9am.",
    "Dana: Thanks. Remember to clock out on the tablet, not the old terminal.",
    "Me: Got it. By the way, my shift ends at 4 on Fridays.",
    "Dana: Perfect. Oh and my birthday is next Thursday, cake in the break room!",
    "Me: I'm allergic to peanuts, so I'll check the label.",
  ].join("\n"),
};
