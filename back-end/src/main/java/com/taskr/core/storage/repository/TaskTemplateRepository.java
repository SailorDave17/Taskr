package com.taskr.core.storage.repository;

import com.taskr.core.model.TaskTemplate;
import org.springframework.data.repository.CrudRepository;

public interface TaskTemplateRepository extends CrudRepository<TaskTemplate, Long> {
}
