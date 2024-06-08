import { Cloud, File, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Dropzone from "react-dropzone";
import { Progress } from "./ui/progress";
import { trpc } from "@/app/_trpc/client";
import { useToast } from "./ui/use-toast";

export default function UploadDropzone() {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const { toast } = useToast();

  const startSimulatedProgress = () => {
    setUploadProgress(0);
    const interval = setInterval(() => {
      setUploadProgress((prevProgress) => {
        if (prevProgress >= 95) {
          clearInterval(interval);
          console.log(prevProgress);
          return prevProgress;
        }

        return prevProgress + 5;
      });
    }, 500);

    return interval;
  };

  const { mutate: startPolling } = trpc.getFile.useMutation({
    onSuccess: (file) => {
      router.push(`/dashboard/${file.id}`);
    },
    retry: true,
    retryDelay: 500,
  });

  const { mutate: saveFile } = trpc.saveFile.useMutation({
    onSuccess: (data: any) => {
      if (data) startPolling({ key: data });
    },
    onError: () => {
      return toast({
        title: "Something went wrong",
        description: "Please try again later",
        variant: "destructive",
      });
    },
  });

  const onDropHandler = async (acceptedFiles: any) => {
    setIsUploading(true);
    const progressInterval = startSimulatedProgress();
    const formData = new FormData();
    formData.append("file", acceptedFiles[0]);
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });
    const { fileName, key, url } = await response.json();
    saveFile({ fileName, key, url });
    clearInterval(progressInterval);
    setUploadProgress(100);
  };

  return (
    <Dropzone multiple={false} onDrop={onDropHandler}>
      {({ getRootProps, getInputProps, acceptedFiles }) => (
        <div {...getRootProps()} className="border h-64 m-4 border-dashed border-gray-300 rounded-lg">
          <div className="flex items-center justify-center h-full w-full">
            <label
              htmlFor="dropzone-file"
              className="flex flex-col items-center justify-center w-full h-full rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100"
            >
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <Cloud className="h-6 w-6 text-zinc-500 mb-2" />
                <p className="mb-2 text-sm text-zinc-700">
                  <span className="font-semibold">Click to upload</span> or drag and drop
                </p>
                <p className="text-xs text-zinc-500">PDF (up to {"4"}MB)</p>
              </div>

              {acceptedFiles && acceptedFiles[0] ? (
                <div className="max-w-xs bg-white flex items-center rounded-md overflow-hidden outline outline-[1px] outline-zinc-200 divide-x divide-zinc-200">
                  <div className="px-3 py-2 h-full grid place-items-center">
                    <File className="h-4 w-4 text-blue-500" />
                  </div>
                  <div className="px-3 py-2 h-full text-sm truncate">{acceptedFiles[0].name}</div>
                </div>
              ) : null}

              {isUploading ? (
                <div className="w-full mt-4 max-w-xs mx-auto">
                  <Progress
                    indicatorColor={uploadProgress === 100 ? "bg-green-500" : ""}
                    value={uploadProgress}
                    className="h-1 w-full bg-zinc-200"
                  />
                  {uploadProgress === 100 ? (
                    <div className="flex gap-1 items-center justify-center text-sm text-zinc-700 text-center pt-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Redirecting...
                    </div>
                  ) : null}
                </div>
              ) : null}

              <input {...getInputProps()} type="file" id="dropzone-file" className="hidden" />
            </label>
          </div>
        </div>
      )}
    </Dropzone>
  );
}