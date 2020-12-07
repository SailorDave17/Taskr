package com.taskr.core.Storages;

import com.taskr.core.Resources.Task;
import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import org.springframework.stereotype.Service;

@Service
public class TaskStorage {

    private TaskRepository taskRepo;
    private TaskTemplateStorage taskTemplateStorage;

    public TaskStorage(TaskRepository taskRepo, TaskTemplateStorage taskTemplateStorage) {
        this.taskRepo = taskRepo;
        this.taskTemplateStorage = taskTemplateStorage;
    }

    public void save(Task task) {

        taskRepo.save(task);
    }

    public void deleteById(Long id) {
        taskRepo.deleteById(id);
    }

    public void deleteByTemplateId(Long templateId){
        for (Task task : taskRepo.findTasksByTemplateId(templateId)){
            taskRepo.delete(task);
        }
    }

    public void updateAllTasksBasedOnTemplate(Long taskTemplateId) {
        TaskTemplate taskTemplate = taskTemplateStorage.findById(taskTemplateId);
        for (Task task : taskRepo.findTasksByTemplateId(taskTemplateId)) {
            task.setDescription(taskTemplate.getDescription());
            task.setMinutesExpectedToComplete(taskTemplate.getMinutesExpectedToComplete());
            task.setTitle(taskTemplate.getName());
            taskRepo.save(task);
        }
    }

    public Iterable<Task> findAll() {
        return taskRepo.findAll();
    }

    public Task findById(Long id) {
        User dummyOwner = new User("Dummy user");
        TaskTemplate dummyTaskTemplate = new TaskTemplate("Task not found");
        Task dummyTask = new Task(dummyOwner, dummyTaskTemplate);
        if (taskRepo.findById(id).isPresent()) {
            return taskRepo.findById(id).get();
        } else return dummyTask;
    }

}
