import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AppDialogProvider, useAppDialog } from "./AppDialog.js";

function Harness() {
  const { confirm, prompt } = useAppDialog();
  const [result, setResult] = useState("");
  return <><button onClick={() => void prompt({ title: "Rename Monitoring Area", label: "Monitoring Area name", defaultValue: "Fairgrounds", required: true, confirmLabel: "Save changes" }).then((value) => setResult(value ?? "cancelled"))}>Rename</button><button onClick={() => void confirm({ title: "Delete purpose?", description: "This cannot be undone.", danger: true, confirmLabel: "Delete purpose" }).then((value) => setResult(String(value)))}>Delete</button><output>{result}</output></>;
}

describe("AppDialog", () => {
  afterEach(cleanup);
  it("edits a value in an app-owned dialog instead of a browser prompt", async () => {
    render(<AppDialogProvider><Harness /></AppDialogProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByRole("dialog", { name: "Rename Monitoring Area" })).toBeInTheDocument();
    const field = screen.getByRole("textbox", { name: "Monitoring Area name" });
    expect(field).toHaveValue("Fairgrounds");
    await userEvent.clear(field);
    await userEvent.type(field, "Park & ride");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("status")).toHaveTextContent("Park & ride");
  });

  it("uses an explicit destructive confirmation", async () => {
    render(<AppDialogProvider><Harness /></AppDialogProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete purpose" }));
    expect(screen.getByRole("status")).toHaveTextContent("true");
  });
});
