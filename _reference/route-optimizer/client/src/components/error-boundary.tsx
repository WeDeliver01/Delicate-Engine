import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  handleExportLog = () => {
    const logData = {
      timestamp: new Date().toISOString(),
      error: this.state.error?.message,
      stack: this.state.error?.stack,
      userAgent: navigator.userAgent,
      localStorage: Object.keys(localStorage),
    };
    const blob = new Blob([JSON.stringify(logData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `debug-log-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-background p-4">
          <Card className="max-w-lg w-full">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="p-2 rounded-md bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Something went wrong</h2>
                <p className="text-sm text-muted-foreground">
                  The application encountered an unexpected error.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted rounded-md p-3">
                <p className="text-sm font-mono text-muted-foreground break-all">
                  {this.state.error?.message || "Unknown error"}
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  data-testid="button-reload"
                  onClick={() => window.location.reload()}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reload App
                </Button>
                <Button
                  data-testid="button-export-debug"
                  variant="outline"
                  onClick={this.handleExportLog}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export Debug Log
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}
