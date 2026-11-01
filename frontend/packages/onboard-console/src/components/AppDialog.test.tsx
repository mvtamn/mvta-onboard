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

  it("offers a fixed set of answers as buttons and returns the one picked", async () => {
    function Chooser() {
      const { choose } = useAppDialog();
      const [result, setResult] = useState("");
      return <><button onClick={() => void choose({ title: "Record Avail result", choices: [{ value: "entered", label: "Built in Avail" }, { value: "conflict", label: "Avail refused it", description: "Retry, or run it manually" }] }).then((value) => setResult(value ?? "cancelled"))}>Record</button><output>{result}</output></>;
    }
    render(<AppDialogProvider><Chooser /></AppDialogProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(screen.getByRole("dialog", { name: "Record Avail result" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Avail refused it/ }));
    expect(screen.getByRole("status")).toHaveTextContent("conflict");

    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("status")).toHaveTextContent("cancelled");
  });

  it("uses an explicit destructive confirmation", async () => {
    render(<AppDialogProvider><Harness /></AppDialogProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete purpose" }));
    expect(screen.getByRole("status")).toHaveTextContent("true");
  });
});
