import { API_CONFIG } from "@/services/api";

const RobotViewer = () => {
  return (
    <div className="h-full w-full">
      <iframe
        src={API_CONFIG.robotViewerUrl}
        className="w-full h-full border-0"
        title="3D Robot Viewer"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      />
    </div>
  );
};

export default RobotViewer;
