import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/** Open the Select with this label and click an option by its text. */
export async function chooseOption(user: UserEvent, label: string, option: string | RegExp) {
  await user.click(screen.getByLabelText(label));
  await user.click(await screen.findByRole("option", { name: option }));
}
