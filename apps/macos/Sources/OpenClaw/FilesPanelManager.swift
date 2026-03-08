import Foundation
import Observation
import OpenClawKit
import SwiftUI

struct WorkspaceFile: Identifiable, Codable, Equatable {
    let id: UUID
    let name: String
    let path: String
    let isDirectory: Bool
    let size: Int?
    let updatedAtMs: Int?

    init(name: String, path: String, isDirectory: Bool, size: Int? = nil, updatedAtMs: Int? = nil) {
        self.id = UUID()
        self.name = name
        self.path = path
        self.isDirectory = isDirectory
        self.size = size
        self.updatedAtMs = updatedAtMs
    }
}

@MainActor
@Observable
class WorkspaceFilesModel {
    var files: [WorkspaceFile] = []
    var currentPath: String = ""
    var isLoading: Bool = false
    var errorText: String?
    var agentId: String = "main"

    init() {}

    var currentDirectory: String {
        if currentPath.isEmpty {
            return "/"
        }
        return currentPath
    }

    var parentPath: String? {
        guard !currentPath.isEmpty else { return nil }
        let components = currentPath.split(separator: "/")
        guard components.count > 1 else { return nil }
        return components.dropLast().joined(separator: "/")
    }

    func loadFiles() async {
        isLoading = true
        errorText = nil

        do {
            let data = try await GatewayConnection.shared.request(method: "workspace-files.list", params: ["agentId": AnyCodable(agentId)], timeoutMs: 15000)

            struct ListResponse: Codable {
                let files: [FileEntry]
                struct FileEntry: Codable {
                    let name: String
                    let path: String
                    let isDirectory: Bool
                    let size: Int?
                    let updatedAtMs: Int?
                }
            }

            let response = try JSONDecoder().decode(ListResponse.self, from: data)
            self.files = response.files.map { entry in
                WorkspaceFile(
                    name: entry.name,
                    path: entry.path,
                    isDirectory: entry.isDirectory,
                    size: entry.size,
                    updatedAtMs: entry.updatedAtMs
                )
            }
            self.currentPath = ""
        } catch {
            errorText = error.localizedDescription
        }

        isLoading = false
    }

    func navigateToFolder(_ folder: WorkspaceFile) async {
        guard folder.isDirectory else { return }
        currentPath = folder.path
        await loadFiles()
    }

    func navigateUp() async {
        guard let parent = parentPath else { return }
        currentPath = parent
        await loadFiles()
    }

    func createFile(name: String, isDirectory: Bool, content: String = "") async -> Bool {
        let fullPath = currentPath.isEmpty ? name : "\(currentPath)/\(name)"

        do {
            _ = try await GatewayConnection.shared.request(method: "workspace-files.create", params: [
                "agentId": AnyCodable(agentId),
                "path": AnyCodable(fullPath),
                "isDirectory": AnyCodable(isDirectory),
                "content": AnyCodable(content)
            ], timeoutMs: 15000)
            await loadFiles()
            return true
        } catch {
            errorText = error.localizedDescription
            return false
        }
    }

    func deleteFile(_ file: WorkspaceFile) async -> Bool {
        do {
            _ = try await GatewayConnection.shared.request(method: "workspace-files.delete", params: [
                "agentId": AnyCodable(agentId),
                "path": AnyCodable(file.path)
            ], timeoutMs: 15000)
            await loadFiles()
            return true
        } catch {
            errorText = error.localizedDescription
            return false
        }
    }
}

final class FilesPanelManager: ObservableObject {
    static let shared = FilesPanelManager()

    @Published var isVisible = false
    @Published var model = WorkspaceFilesModel()

    private var windowController: FilesPanelWindowController?

    private init() {}

    func show() {
        if windowController == nil {
            windowController = FilesPanelWindowController(model: model)
        }
        windowController?.show()
        isVisible = true
    }

    func hide() {
        windowController?.close()
        isVisible = false
    }
}

final class FilesPanelWindowController: NSWindowController {
    private let model: WorkspaceFilesModel

    init(model: WorkspaceFilesModel) {
        self.model = model

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 400, height: 500),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Files"
        window.minSize = NSSize(width: 300, height: 400)
        window.center()

        super.init(window: window)

        let contentView = FilesPanelView(model: model)
        window.contentView = NSHostingView(rootView: contentView)

        window.delegate = self
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func show() {
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        
        Task { @MainActor in
            await model.loadFiles()
        }
    }
}

extension FilesPanelWindowController: NSWindowDelegate {
    func windowWillClose(_ notification: Notification) {
        FilesPanelManager.shared.isVisible = false
    }
}

struct FilesPanelView: View {
    @Bindable var model: WorkspaceFilesModel
    @State private var showCreateDialog = false
    @State private var createIsDirectory = false
    @State private var showDeleteDialog = false
    @State private var selectedFile: WorkspaceFile?

    var body: some View {
        VStack(spacing: 0) {
            if model.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = model.errorText {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                        .foregroundStyle(.red)
                    Text(error)
                        .multilineTextAlignment(.center)
                    Button("Retry") {
                        Task { await model.loadFiles() }
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    if !model.currentPath.isEmpty {
                        Button {
                            Task { await model.navigateUp() }
                        } label: {
                            Label("Go Up", systemImage: "arrow.up")
                        }
                    }

                    ForEach(model.files) { file in
                        Button {
                            Task { await model.navigateToFolder(file) }
                        } label: {
                            HStack {
                                Image(systemName: file.isDirectory ? "folder.fill" : "doc.fill")
                                    .foregroundStyle(file.isDirectory ? .blue : .secondary)
                                Text(file.name)
                                Spacer()
                                if let size = file.size {
                                    Text(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .contextMenu {
                            Button("Delete") {
                                selectedFile = file
                                showDeleteDialog = true
                            }
                        }
                    }
                }
                .listStyle(.inset)
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button {
                        createIsDirectory = false
                        showCreateDialog = true
                    } label: {
                        Label("New File", systemImage: "doc")
                    }
                    Button {
                        createIsDirectory = true
                        showCreateDialog = true
                    } label: {
                        Label("New Folder", systemImage: "folder")
                    }
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $showCreateDialog) {
            CreateFileSheet(isDirectory: createIsDirectory) { name, content in
                _ = await model.createFile(name: name, isDirectory: createIsDirectory, content: content)
            }
        }
        .alert("Delete File?", isPresented: $showDeleteDialog) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                if let file = selectedFile {
                    Task { _ = await model.deleteFile(file) }
                }
            }
        } message: {
            if let file = selectedFile {
                Text("Are you sure you want to delete \(file.name)? This cannot be undone.")
            }
        }
    }
}

struct CreateFileSheet: View {
    let isDirectory: Bool
    let onCreate: (String, String) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name: String = ""
    @State private var content: String = ""
    @State private var isCreating: Bool = false

    var body: some View {
        VStack(spacing: 16) {
            Text(isDirectory ? "New Folder" : "New File")
                .font(.headline)

            TextField("Name", text: $name)
                .textFieldStyle(.roundedBorder)

            if !isDirectory {
                TextEditor(text: $content)
                    .frame(height: 150)
                    .border(Color.gray.opacity(0.3))
            }

            HStack {
                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)

                Spacer()

                Button("Create") {
                    isCreating = true
                    Task {
                        await onCreate(name, content)
                        dismiss()
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(name.isEmpty || isCreating)
            }
        }
        .padding()
        .frame(width: 350, height: isDirectory ? 150 : 300)
    }
}
