package com.taskr.core.Storages;

import com.taskr.core.Resources.Task;
import org.springframework.data.repository.CrudRepository;

public interface TaskRepository extends CrudRepository<Task, Long> {
}
