
import { NgModule } from '@angular/core';
import { LucideAngularModule, Folder, FolderOpen, File, Code2, Bot, Sparkles, Rocket, Settings, Bell, Search, Plus, Pencil, Trash2, CircleCheck, CircleX, TriangleAlert, Lock, User, FileText, GitBranch, Terminal, ChartNoAxesColumn, BarChart3, Sun, Moon, MoreVertical, RefreshCw, Download, Upload, ExternalLink, Calendar, Clock, Check, X, ArrowLeft, ArrowRight, ChevronDown, ChevronUp, ChevronRight, Play, Square, Menu, Maximize2, Minimize2, Copy, Eye, Zap, Layers, Cpu, Server, Activity, ArrowUp, Send, CheckCircle, XCircle, Lightbulb, Wrench, FlaskConical, FileCode2, FileJson, Palette, Globe, Image, Home, Loader } from 'lucide-angular';

@NgModule({
  imports: [
    LucideAngularModule.pick({
      Folder, FolderOpen, File, Code2, Bot, Sparkles, Rocket, Settings, Bell, Search, Plus, Pencil, Trash2, CircleCheck, CircleX, TriangleAlert, Lock, User, FileText, GitBranch, Terminal, ChartNoAxesColumn, BarChart3, Sun, Moon, MoreVertical, RefreshCw, Download, Upload, ExternalLink, Calendar, Clock, Check, X, ArrowLeft, ArrowRight, ChevronDown, ChevronUp, ChevronRight, Play, Square, Menu, Maximize2, Minimize2, Copy, Eye, Zap, Layers, Cpu, Server, Activity, ArrowUp, Send, CheckCircle, XCircle, Lightbulb, Wrench, FlaskConical, FileCode2, FileJson, Palette, Globe, Image, Home, Loader
    })
  ],
  exports: [LucideAngularModule]
})
export class SharedIconsModule { }

