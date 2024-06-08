"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "./ui/dialog";
import { Button } from "./ui/button";
import UploadDropzone from "./UploadDropzone";

export default function UploadButton() {
  const [isOpen, setIsOpen] = useState<boolean>();

  const onOpenChangeHandler = (visible: boolean) => {
    if (!visible) {
      setIsOpen(visible);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChangeHandler}>
      <DialogTrigger asChild onClick={() => setIsOpen(true)}>
        <Button>Upload PDF</Button>
      </DialogTrigger>
      <DialogContent>
        <UploadDropzone />
      </DialogContent>
    </Dialog>
  );
}
