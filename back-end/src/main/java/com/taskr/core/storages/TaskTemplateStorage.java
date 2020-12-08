package com.taskr.core.storages;

import com.taskr.core.resources.TaskTemplate;
import org.springframework.stereotype.Service;


@Service
public class TaskTemplateStorage {

    private TaskTemplateRepository taskTemplateRepo;


    public TaskTemplateStorage(TaskTemplateRepository taskTemplateRepo) {
        this.taskTemplateRepo = taskTemplateRepo;
    }

    public void save(TaskTemplate taskTemplate) {
        taskTemplateRepo.save(taskTemplate);
    }

    public void deleteById(Long id) {
        taskTemplateRepo.deleteById(id);
    }

    public Iterable<TaskTemplate> findAll() {
        return taskTemplateRepo.findAll();
    }

    public TaskTemplate findById(Long id) {
        TaskTemplate dummyTaskTemplate = new TaskTemplate("TaskTemplate not found", 300, 300);
        if (taskTemplateRepo.findById(id).isPresent()) {
            return taskTemplateRepo.findById(id).get();
        } else return dummyTaskTemplate ;
    }

}
