package com.taskr.core.Storages;

import com.taskr.core.Resources.TaskTemplate;
import org.springframework.data.repository.CrudRepository;

public interface TaskTemplateRepository extends CrudRepository<TaskTemplate, Long> {
}
